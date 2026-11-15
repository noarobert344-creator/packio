"use client";

import { Check } from "lucide-react";
import { ActionButton } from "@/components/shared/action-dialog";
import { markContactHandledAction } from "@/server/actions/admin/people";

export function MarkContactHandled({ id }: { id: string }) {
  return (
    <ActionButton action={markContactHandledAction} fields={{ id }} variant="outline" size="sm">
      <Check /> Marquer comme traité
    </ActionButton>
  );
}
