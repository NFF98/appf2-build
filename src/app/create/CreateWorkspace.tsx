import { useEffect, useMemo, useRef, useState } from "react";

import { Brand } from "../shell/Brand.js";
import { decidableAssumptions } from "./assumptions.js";
import { AssumptionList } from "./AssumptionList.js";
import type { CreationController } from "./creation-controller.js";
import { stageView, stepAnswers, type CreationSession, type CreationStep, type ProvidedAnswer, type RecoveryReason } from "./creation-session.js";
import { IntentDisclosure, type DisclosureMode } from "./IntentDisclosure.js";
import { QuestionField } from "./QuestionField.js";
import { StageProgress } from "./StageProgress.js";
import { ValueView } from "./ValueView.js";

type WorkspaceProps = {
  readonly session: CreationSession;
  readonly controller: CreationController;
  readonly onBack: () => void;
};

type BodyProps = WorkspaceProps & { readonly onEditIntent: () => void };

const STATUS_COPY = {
  ANALYZING: { title: "正在理解你的想法…", detail: "我們正在整理你要做的 App，有需要你決定的地方才會問你。" },
  BUILDING: { title: "正在把需求變成 App", detail: "正在組合你的 App" },
  BUILD_VALIDATED: { title: "已完成互動檢查", detail: "你的 App 內容已整理並檢查完成。" },
  INTERRUPTED: { title: "已暫停等待", detail: "你的內容還在，可以從這裡繼續。" }
} as const;

const RECOVERY_DETAIL: Readonly<Record<RecoveryReason, string>> = {
  RETRYABLE: "連線或服務暫時沒有回應，可以再試一次。",
  STALE_VERSION: "這個需求剛在其他地方更新過，請重新整理後再確認。",
  MALFORMED: "這次收到的結果不完整，我們沒有顯示或自動接受任何設定。",
  NOT_FOUND: "找不到這個需求的進度，可以用同樣的內容重新整理。",
  REJECTED: "這個內容目前無法處理，請修改後再試。"
};

const DECISION_LABELS = { ACCEPT: "接受", REJECT: "不使用", EDIT: "修改為" } as const;

function ProvidedSummary({ provided }: { readonly provided: readonly ProvidedAnswer[] }) {
  if (provided.length === 0) return null;
  return (
    <details className="provided">
      <summary>已提供的資訊</summary>
      <dl className="provided-list">
        {provided.map((answer) => (
          <div key={answer.key} className="provided-item">
            <dt>{answer.label}</dt>
            <dd>
              <ValueView value={answer.value} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The round input of a request that did not complete, shown back so the User sees nothing was lost. */
function UnsentSummary({ step }: { readonly step: CreationStep }) {
  if (step.kind !== "ANSWERS") return null;
  const names = new Map(step.decision.assumptions.map((assumption) => [assumption.assumptionId, assumption.description]));
  return (
    <section className="unsent" aria-label="你剛才填寫的內容">
      <h2 className="unsent-title">你剛才填寫的內容</h2>
      <dl className="provided-list">
        {stepAnswers(step).map((answer) => (
          <div key={answer.key} className="provided-item">
            <dt>{answer.label}</dt>
            <dd>
              <ValueView value={answer.value} />
            </dd>
          </div>
        ))}
        {step.body.assumption_decisions.map((decision) => (
          <div key={decision.assumption_id} className="provided-item">
            <dt>{names.get(decision.assumption_id) ?? ""}</dt>
            <dd>
              <span>{DECISION_LABELS[decision.decision]}</span>
              {decision.decision === "EDIT" ? <ValueView value={decision.edited_value} /> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DecisionBody({ session, controller, onEditIntent }: BodyProps) {
  const decision = session.decision;
  const decidableIds = useMemo(() => new Set(decision === null ? [] : decidableAssumptions(decision).map((assumption) => assumption.assumptionId)), [decision]);
  if (decision === null) return null;
  const clarifying = session.phase.kind === "CLARIFICATION_REQUIRED";
  return (
    <div className="workspace-card" aria-busy={session.busy}>
      <h1 className="workspace-title" tabIndex={-1}>
        {clarifying ? "還差一點資訊" : "確認幾個設定"}
      </h1>
      {decision.questions.map((question, index) => (
        <QuestionField
          key={question.questionId}
          question={question}
          number={index + 1}
          draft={session.answerDrafts[question.questionId]}
          problem={session.problems[question.questionId]}
          nodeProblems={session.nodeProblems}
          disabled={session.busy}
          onChange={(draft) => controller.updateAnswer(question.questionId, draft)}
        />
      ))}
      {decision.assumptions.length > 0 ? (
        <AssumptionList
          assumptions={decision.assumptions}
          decidableIds={decidableIds}
          drafts={session.assumptionDrafts}
          problems={session.problems}
          nodeProblems={session.nodeProblems}
          disabled={session.busy}
          onChange={(id, draft) => controller.updateAssumption(id, draft)}
        />
      ) : null}
      <div className="workspace-actions">
        {clarifying ? null : (
          <button type="button" className="btn btn-secondary" onClick={onEditIntent}>
            修改需求
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={session.busy} onClick={() => controller.submitDecisions()}>
          {clarifying ? "繼續" : "用這些設定繼續"}
        </button>
      </div>
    </div>
  );
}

/** F12 recovery: only actions that can actually help — no Retry when the identical request must fail again. */
function RecoveryBody({ session, controller, onEditIntent }: BodyProps) {
  const phase = session.phase;
  if (phase.kind !== "RECOVERABLE_FAILURE") return null;
  const revisable = phase.step.kind === "ANSWERS" && (phase.reason === "RETRYABLE" || phase.reason === "REJECTED");
  const reanalysable = phase.reason === "STALE_VERSION" || phase.reason === "MALFORMED" || phase.reason === "NOT_FOUND";
  return (
    <div className="workspace-card recovery">
      <h1 className="workspace-title" tabIndex={-1}>
        目前沒完成，但你的內容還在。
      </h1>
      <p className="workspace-detail">{RECOVERY_DETAIL[phase.reason]}</p>
      <UnsentSummary step={phase.step} />
      <div className="workspace-actions">
        <button type="button" className="btn btn-secondary" onClick={onEditIntent}>
          修改需求
        </button>
        {revisable ? (
          <button type="button" className="btn btn-secondary" onClick={() => controller.reviseRound()}>
            回去修改
          </button>
        ) : null}
        {phase.reason === "RETRYABLE" ? (
          <button type="button" className="btn btn-primary" disabled={session.busy} onClick={() => controller.retry()}>
            再試一次
          </button>
        ) : null}
        {reanalysable ? (
          <button type="button" className="btn btn-primary" disabled={session.busy} onClick={() => controller.reanalyze()}>
            重新整理需求
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StatusBody({ session, controller }: BodyProps) {
  const kind = session.phase.kind;
  if (kind !== "ANALYZING" && kind !== "BUILDING" && kind !== "BUILD_VALIDATED" && kind !== "INTERRUPTED") return null;
  const copy = STATUS_COPY[kind];
  return (
    <div className="workspace-status" role="status" aria-live="polite">
      <h1 className="workspace-title" tabIndex={-1}>
        {copy.title}
      </h1>
      <p className="workspace-detail">{copy.detail}</p>
      {kind === "INTERRUPTED" ? (
        <button type="button" className="btn btn-primary" onClick={() => controller.retry()}>
          繼續
        </button>
      ) : null}
    </div>
  );
}

/**
 * S02 Create Workspace: one focused surface whose body follows the F00 creation state. Only F01 decisions
 * stop the flow; everything the User typed survives failures and the explicit 「修改需求」 path.
 */
export function CreateWorkspace(props: WorkspaceProps) {
  const { session, controller, onBack } = props;
  const [disclosure, setDisclosure] = useState<DisclosureMode>("CLOSED");
  const mainRef = useRef<HTMLElement>(null);
  const kind = session.phase.kind;
  const deciding = kind === "CLARIFICATION_REQUIRED" || kind === "ASSUMPTION_REVIEW";
  const editable = deciding || kind === "RECOVERABLE_FAILURE";

  useEffect(() => {
    mainRef.current?.querySelector<HTMLElement>(".workspace-title")?.focus({ preventScroll: true });
  }, [kind]);

  const bodyProps: BodyProps = { ...props, onEditIntent: () => setDisclosure("EDIT") };
  return (
    <div className="s02">
      <header className="s02-header">
        <Brand />
        <button type="button" className="btn btn-link back-link" onClick={onBack}>
          <span aria-hidden="true">← </span>回到建立 App
        </button>
      </header>
      <main className="s02-main" ref={mainRef}>
        <StageProgress view={stageView(session.phase)} />
        <IntentDisclosure
          key={session.rawIntent}
          rawIntent={session.rawIntent}
          editable={editable && !session.busy}
          mode={disclosure}
          onModeChange={setDisclosure}
          onApply={(text) => controller.editIntent(text)}
        />
        <ProvidedSummary provided={session.provided} />
        {deciding ? <DecisionBody {...bodyProps} /> : null}
        <RecoveryBody {...bodyProps} />
        <StatusBody {...bodyProps} />
      </main>
    </div>
  );
}
