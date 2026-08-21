'use client';

import DailySessionFlow from '../../components/DailySessionFlow';
import StudyRoadmap from '../../components/StudyRoadmap';

export default function PracticePage() {
  return (
    <div className="flex flex-col gap-3">
      <DailySessionFlow />
      <StudyRoadmap />
    </div>
  );
}
