'use client';

// TEMPORARY — lets the owner compare 3 candidate Settings-page redesigns
// side by side (one at a time) before picking one to actually replace
// app/settings/page.tsx. Delete this file, its import/call site in
// app/admin/page.tsx, and components/settingsPreview/ once a design is
// picked and the real page is rebuilt to match it.

import { useState } from 'react';
import SettingsDesignA from './settingsPreview/SettingsDesignA';
import SettingsDesignB from './settingsPreview/SettingsDesignB';
import SettingsDesignC from './settingsPreview/SettingsDesignC';

type DesignId = 'A' | 'B' | 'C';

const DESIGNS: Record<DesignId, { label: string; blurb: string; Component: React.ComponentType }> = {
  A: { label: 'A · Drill-down', blurb: 'Root screen shows only 5 group rows with a one-line summary each — tap one to slide into its own screen, like iPhone Settings’ own top level.', Component: SettingsDesignA },
  B: { label: 'B · Accordion', blurb: 'Everything stays on one page — each group is a card you tap to expand/collapse in place. Account starts open, the rest start closed.', Component: SettingsDesignB },
  C: { label: 'C · Compact list', blurb: 'The densest option: one flat list, current value shown on each row, tapping opens a small sheet with just that control. Toggles switch right on the row.', Component: SettingsDesignC },
};

export default function SettingsRedesignPreview() {
  const [active, setActive] = useState<DesignId>('A');
  const { blurb, Component } = DESIGNS[active];

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-stone-800">⚙️ Settings redesign — pick one (temporary)</h2>
        <p className="text-stone-400 text-xs -mt-0.5">
          All 3 are fully wired to your real settings — clicking a control here really changes it. Switch tabs to compare.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(DESIGNS) as DesignId[]).map(id => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={`text-center py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
              active === id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-stone-200 bg-white/60 text-stone-500 hover:border-indigo-300'
            }`}
          >
            {DESIGNS[id].label}
          </button>
        ))}
      </div>
      <p className="text-stone-500 text-xs bg-white/60 rounded-lg px-3 py-2">{blurb}</p>
      <div className="rounded-2xl border-2 border-dashed border-indigo-200 p-3">
        <Component />
      </div>
    </div>
  );
}
