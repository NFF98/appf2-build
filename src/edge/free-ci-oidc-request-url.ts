/** Trust only the GitHub Actions-managed OIDC issuance endpoint.
 * The official issuer is different from this runner-side token exchange URL.
 * GitHub-hosted runners may use region-specific pipelinesghub* hostnames.
 */
export function trustedFreeCiOidcRequestUrl(raw:string):URL|null{
 try{
  if(raw.length>4096)return null;
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username!==""||url.password!==""||
   url.port!==""||url.hash!==""||url.pathname==="/"||
   !/^pipelines(?:ghub[a-z0-9]+)?\.actions\.githubusercontent\.com$/u.test(url.hostname))
   return null;
  return url;
 }catch{return null;}
}
