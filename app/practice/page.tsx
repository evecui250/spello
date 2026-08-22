'use client';

import DailySessionFlow from '../../components/DailySessionFlow';

export default function PracticePage() {
  // StudyRoadmap itself now renders from app/layout.tsx (stacked with
  // NavBar as one fixed bottom bar) — this extra bottom margin is just to
  // keep the round card's own content (e.g. its Check button) clear of
  // that taller combined bar, on top of <main>'s own NavBar-only
  // allowance.
  return (
    <div className="mb-14">
      <DailySessionFlow />
    </div>
  );
}
