import { useState, type Ref } from "react";

import { CapsulePreview } from "./CapsulePreview.js";
import { CAPSULE_CATEGORIES, capsulesFor, FIRST_SCREEN_CAPSULES, type Capsule, type CategoryFilter } from "./capsules.js";

type InspirationProps = {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly onTry: (capsule: Capsule) => void;
};

function CapsuleCard({ capsule, onTry }: { readonly capsule: Capsule; readonly onTry: (capsule: Capsule) => void }) {
  const titleId = `capsule-${capsule.id}-title`;
  return (
    <article className="capsule-card" aria-labelledby={titleId}>
      <CapsulePreview kind={capsule.preview} label={`${capsule.title} App 預覽`} />
      <div className="capsule-body">
        <h3 id={titleId} className="capsule-title">
          {capsule.title}
        </h3>
        <p className="capsule-outcome">{capsule.outcome}</p>
        <button type="button" className="btn btn-secondary capsule-try" aria-label={`試試看：${capsule.title}`} onClick={() => onTry(capsule)}>
          試試看 <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

/**
 * S01 Inspiration: App Preview Cards under plain-text category tabs. 「探索更多」 continues in place on S01;
 * `Try` only prefills the editable Composer (F00-AC-038: never a Shared App restore / Blueprint hydration).
 */
export function Inspiration({ headingRef, onTry }: InspirationProps) {
  const [filter, setFilter] = useState<CategoryFilter>("全部");
  const [expanded, setExpanded] = useState(false);
  const capsules = capsulesFor(filter);
  const visible = expanded ? capsules : capsules.slice(0, FIRST_SCREEN_CAPSULES);

  const choose = (next: CategoryFilter): void => {
    setFilter(next);
    setExpanded(false);
  };

  return (
    <section className="inspiration" aria-labelledby="inspiration-title">
      <div className="inspiration-head">
        <h2 id="inspiration-title" className="inspiration-title" ref={headingRef} tabIndex={-1}>
          試試這些靈感
        </h2>
        <div className="category-tabs" role="group" aria-label="靈感分類">
          {CAPSULE_CATEGORIES.map((category) => (
            <button key={category} type="button" className="category-tab" aria-pressed={filter === category} onClick={() => choose(category)}>
              {category}
            </button>
          ))}
        </div>
        {visible.length < capsules.length ? (
          <button type="button" className="btn btn-ghost explore-more" onClick={() => setExpanded(true)}>
            探索更多 <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
      <ul className="capsule-grid">
        {visible.map((capsule) => (
          <li key={capsule.id}>
            <CapsuleCard capsule={capsule} onTry={onTry} />
          </li>
        ))}
      </ul>
    </section>
  );
}
