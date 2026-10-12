import { describe, expect, test } from "vitest";

import { adminUrl, realPgHarness } from "./pg001-real-pg-harness.js";

/**
 * PostgREST exposure of schema `public` (Supabase `[api] schemas = ["public", ...]`): with Supabase's default privileges
 * replayed before every migration, the PostgREST request roles (anon / authenticated) and PUBLIC must hold nothing on
 * APPF2 tables, and must not execute any SECURITY DEFINER helper. service_role is Supabase's BYPASSRLS platform key.
 */
const harness = realPgHarness("rest");
const { sql } = harness;
const REQUEST_ROLES = ["anon", "authenticated"];

describe.skipIf(adminUrl === undefined)("PG-001 PostgREST exposure on real PostgreSQL (Supabase default privileges)", () => {
  test("anon / authenticated / PUBLIC hold no privilege on any public table, view or sequence", async () => {
    const grants = await sql<{ object: string; grantee: string; privilege: string }>(`
      SELECT c.relname AS object, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
             a.privilege_type AS privilege
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND (a.grantee = 0 OR a.grantee::regrole::text = ANY($1))
      ORDER BY 1, 2, 3`, [REQUEST_ROLES]);
    const tables = await sql<{ relname: string; rls: boolean }>(
      "SELECT relname, relrowsecurity AS rls FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY 1"
    );
    console.info(JSON.stringify({ request_role_grants: grants, tables }));
    expect(tables.length).toBeGreaterThan(0);
    expect(grants).toEqual([]);
    expect(tables.filter((table) => !table.rls)).toEqual([]);
  });

  test("as PostgREST request roles every APPF2 table read / write / truncate is refused (42501)", async () => {
    const tables = (await sql<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY 1"
    )).map((row) => row.relname);
    const outcomes: Record<string, string> = {};
    for (const role of REQUEST_ROLES) {
      for (const table of tables) {
        for (const statement of [`SELECT 1 FROM public.${table} LIMIT 1`, `DELETE FROM public.${table}`, `TRUNCATE public.${table}`]) {
          outcomes[`${role}:${statement.split(" ", 1)[0]}:${table}`] = (await harness.sqlStateAs(harness.scratchUrl(), [`SET LOCAL ROLE ${role}`, statement])) ?? "ALLOWED";
        }
      }
    }
    expect(Object.entries(outcomes).filter(([, code]) => code !== "42501")).toEqual([]);
    console.info(JSON.stringify({ request_role_statements_refused: Object.keys(outcomes).length }));
  });

  test("no SECURITY DEFINER helper is executable by anon / authenticated / PUBLIC; anon-executable functions are pinned", async () => {
    const functions = await sql<{ name: string; definer: boolean; anon: boolean; authenticated: boolean; public: boolean }>(`
      SELECT p.oid::regprocedure::text AS name, p.prosecdef AS definer,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS public
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`);
    const definers = functions.filter((fn) => fn.definer);
    expect(definers.length).toBeGreaterThan(0);
    expect(definers.filter((fn) => fn.anon || fn.authenticated || fn.public)).toEqual([]);
    const anonExecutable = functions.filter((fn) => fn.anon || fn.authenticated).map((fn) => fn.name);
    console.info(JSON.stringify({ security_definer: definers.map((fn) => fn.name), anon_executable_invoker_functions: anonExecutable }));
    expect(anonExecutable).toEqual([
      "blueprint_content_reject_immutable_update()",
      "evidence_bucket_date(timestamp with time zone,timestamp with time zone)",
      "evidence_clock_invalid(timestamp with time zone,timestamp with time zone)",
      "evidence_received_bucket_date(timestamp with time zone)",
      "validation_run_reject_mutation()"
    ]);
    const exposed = await sql<{ name: string; trigger: boolean; immutable: boolean }>(`
      SELECT p.oid::regprocedure::text AS name, p.prorettype = 'trigger'::regtype AS trigger, p.provolatile = 'i' AS immutable
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
    expect(exposed.filter((fn) => !fn.trigger && !fn.immutable)).toEqual([]);
  });

  test("service_role is Supabase's BYPASSRLS platform key: it keeps table access, so it must never be a Worker credential", async () => {
    const [role] = await sql<{ bypass: boolean }>("SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'service_role'");
    expect(role?.bypass).toBe(true);
    expect(Object.keys(harness.env()).filter((name) => /SERVICE|SUPABASE/u.test(name))).toEqual([]);
    for (const login of Object.values(harness.logins)) {
      const [member] = await sql<{ member: boolean }>("SELECT pg_has_role($1, 'service_role', 'MEMBER') AS member", [login.role]);
      expect(member?.member, login.role).toBe(false);
    }
  });
});
