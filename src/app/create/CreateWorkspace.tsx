import { useEffect, useRef, useState } from "react";

import { Brand } from "../shell/Brand.js";
import { displayValue } from "./answer-drafts.js";
import { AssumptionList } from "./AssumptionList.js";
import type { CreationController } from "./creation-controller.js";
import { pendingAnswers, stageView, type CreationSession, type ProvidedAnswer } from "./creation-session.js";
import { IntentDisclosure, type DisclosureMode } from "./IntentDisclosure.js";
import { QuestionField } from "./QuestionField.js";
import { StageProgress } from "./StageProgress.js";

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

/** Answers F01 accepted, plus answers kept from a request that did not complete (nothing typed is lost). */
function providedAnswers(session: CreationSession): readonly ProvidedAnswer[] {
  const phase = session.phase;
  const unsent = phase.kind === "RECOVERABLE_FAILURE" || phase.kind === "INTERRUPTED" ? pendingAnswers(phase.step) : [];
  return [...session.provided, ...unsent];
}

function ProvidedSummary({ session }: { readonly session: CreationSession }) {
  const provided = providedAnswers(session);
  if (provided.length === 0) return null;
  return (
    <details className="provided">
      <summary>已提供的資訊</summary>
      <dl className="provided-list">
        {provided.map((answer) => (
          <div key={answer.questionId} className="provided-item">
            <dt>{answer.prompt}</dt>
            <dd>{displayValue(answer.value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function DecisionBody({ session, controller, onEditIntent }: BodyProps) {
  const decision = session.decision;
  if (decision === null) return null;
  const clarifying = session.phase.kind === "CLARIFICATION_REQUIRED";
  return (
    <div className="workspace-card" aria-busy={session.busy}>
      <h1 className="workspace-title" tabIndex={-1}>
        {clarifying ? "還差一點資訊" : "確認幾個設定"}
      </h1>
      {decision.questions.map((question, index) => (
        <QuestionField
          key={question.question_id}
          question={question}
          number={index + 1}
          draft={session.answerDrafts[question.question_id]}
          problem={session.problems[question.question_id]}
          disabled={session.busy}
          onChange={(draft) => controller.updateAnswer(question.question_id, draft)}
        />
      ))}
      {decision.visibleAssumptions.length > 0 ? (
        <AssumptionList
          assumptions={decision.visibleAssumptions}
          drafts={session.assumptionDrafts}
          problems={session.problems}
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

function RecoveryBody({ session, controller, onEditIntent }: BodyProps) {
  const canRetry = session.phase.kind === "RECOVERABLE_FAILURE" ? session.phase.canRetry : true;
  return (
    <div className="workspace-card recovery">
      <h1 className="workspace-title" tabIndex={-1}>
        目前沒完成，但你的內容還在。
      </h1>
      <div className="workspace-actions">
        <button type="button" className="btn btn-secondary" onClick={onEditIntent}>
          修改需求
        </button>
        {canRetry ? (
          <button type="button" className="btn btn-primary" disabled={session.busy} onClick={() => controller.retry()}>
            再試一次
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
        <ProvidedSummary session={session} />
        {deciding ? <DecisionBody {...bodyProps} /> : null}
        {kind === "RECOVERABLE_FAILURE" ? <RecoveryBody {...bodyProps} /> : null}
        <StatusBody {...bodyProps} />
      </main>
    </div>
  );
}
