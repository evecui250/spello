'use client';

import DailySessionFlow from '../../components/DailySessionFlow';
import StudyRoadmap from '../../components/StudyRoadmap';

export default function PracticePage() {
  return (
    <div className="flex flex-row gap-2 items-stretch">
      <div className="flex-1 min-w-0">
        <DailySessionFlow />
      </div>
      <StudyRoadmap />
    </div>
  );
}
