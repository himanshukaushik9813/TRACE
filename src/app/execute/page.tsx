"use client";

import { Page } from "@/components/page";
import { InvestigationGate } from "@/components/inv-gate";
import { GuidedExecute } from "@/components/guided-execute";
import { NextStep } from "@/components/next-step";
import { MarkStep } from "@/components/welcome";
import { withInv } from "@/lib/api";

export default function ExecutePage() {
  return (
    <Page>
      <InvestigationGate>
        {(full, inv) => (
          <>
            <GuidedExecute full={full} invId={inv} />
            <MarkStep step="viewedExecute" />
            <NextStep href={withInv("/reports", inv)} title="See the full report" label="Open Reports">
              What TRACE found, the strategy, how it performed and what was executed, in one place, with a downloadable copy.
            </NextStep>
          </>
        )}
      </InvestigationGate>
    </Page>
  );
}
