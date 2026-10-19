/**
 * The one place account-level notices are rendered.
 *
 * ## What this is for
 *
 * A notice here is a *standing condition*, not an event: an unconfirmed
 * email address, an overdue plan fee. It is true on arrival, stays true
 * across every page until somebody acts on it, and so has to be in the same
 * place every time or it is not a notice, it is a surprise.
 *
 * Inline alerts are the opposite - a form that failed to save, a router that
 * did not answer - and belong next to the thing they are about. Those do not
 * come here.
 *
 * ## Why it exists
 *
 * The two notices this app had were rendered two different ways: one mounted
 * in a layout, one dropped into a single page. The result was that they
 * appeared together on exactly one route, and the plan-fee one vanished the
 * moment the owner clicked through to anything else - on a page that was
 * telling them they owed money. There was no shared idea of "the notice
 * region", so each new notice invented its own placement and its own
 * spacing, and the ordering between them was whatever the file happened to
 * do.
 *
 * So: order is decided here, once, and nowhere else.
 *
 * ## Order, and the cap
 *
 * Severity, not arrival. Money before data quality: an overdue fee can stop
 * the business trading and an unconfirmed address cannot, so it goes first
 * even though it is usually the newer of the two. Callers pass children in
 * the order they should appear.
 *
 * Nothing enforces a maximum, and that is on purpose - a cap that silently
 * dropped the third notice would hide the one that mattered on the day
 * three were true at once. Two is the realistic ceiling; if a third is ever
 * added, the right fix is to ask whether it is really a standing condition.
 *
 * ## `empty:hidden`
 *
 * Every child decides for itself whether it has anything to say, and most
 * return null most of the time. Without this, a tenant with nothing wrong
 * gets the gap and the margin anyway - a stretch of blank space above the
 * page header with no explanation. `empty:` matches an element with no
 * children at all, which is exactly the state this lands in once each notice
 * has rendered nothing.
 */

export function NoticeStack({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 empty:hidden empty:mb-0">
      {children}
    </div>
  );
}
