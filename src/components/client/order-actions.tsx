"use client";

import { KeyRound, Truck, CheckCircle2, XCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog, ActionButton } from "@/components/shared/action-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { CARRIERS } from "@/lib/labels";
import { reportOrderProblemAction, updateOrderAction } from "@/server/actions/customer";

export function OrderActions({
  order,
}: {
  order: { id: string; status: string; trackingNumber: string | null; carrier: string | null; pickupCode: string | null; locationType: string; arrivalOther: boolean };
}) {
  const isPickup = !order.arrivalOther && (order.locationType === "LOCKER" || order.locationType === "RELAY_POINT");
  const postOffice = !order.arrivalOther && order.locationType === "POST_OFFICE";
  const early = order.status === "REGISTERED" || order.status === "SUPPLIER_CONFIRMED";
  const canLocker = ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT"].includes(order.status);
  return (
    <div className="flex flex-wrap gap-2">
      {["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"].includes(order.status) && (
        <ActionDialog
          trigger={
            <Button variant="outline">
              <Truck /> {order.trackingNumber ? "Modifier le suivi" : "Ajouter un numéro de suivi"}
            </Button>
          }
          title="Numéro de suivi"
          description="Le préparateur est prévenu de l'acheminement du colis."
          action={updateOrderAction}
          submitLabel="Enregistrer"
        >
          <input type="hidden" name="orderId" value={order.id} />
          <TextField name="trackingNumber" label="Numéro de suivi" defaultValue={order.trackingNumber ?? ""} required />
          <SelectField name="carrier" label="Transporteur" defaultValue={order.carrier ?? ""} placeholder="Inconnu" options={CARRIERS.map((c) => ({ value: c.code, label: c.label }))} />
        </ActionDialog>
      )}
      {order.status === "REGISTERED" && (
        <ActionButton action={updateOrderAction} fields={{ orderId: order.id, status: "SUPPLIER_CONFIRMED" }} variant="outline">
          <CheckCircle2 /> Commande confirmée par le fournisseur
        </ActionButton>
      )}
      {(canLocker || order.status === "AT_LOCKER") && (
        <ActionDialog
          trigger={
            <Button>
              <KeyRound /> {order.status === "AT_LOCKER" ? "Modifier le code de retrait" : "Colis arrivé : donner le code"}
            </Button>
          }
          title="Votre colis est arrivé ?"
          description={
            postOffice
              ? "Prévenez votre préparateur : il va le chercher au bureau de poste avec sa pièce d'identité. Si vous avez reçu un code ou un avis de passage, indiquez-le."
              : "Donnez le code de retrait reçu par SMS ou e-mail : votre préparateur est prévenu tout de suite et va chercher le colis. Le code n'est visible que par vous et lui."
          }
          action={updateOrderAction}
          submitLabel="Prévenir mon préparateur"
        >
          <input type="hidden" name="orderId" value={order.id} />
          {order.status !== "AT_LOCKER" && <input type="hidden" name="status" value="AT_LOCKER" />}
          <TextField
            name="pickupCode"
            label={isPickup ? "Code de retrait" : "Code de retrait (s'il y en a un)"}
            defaultValue={order.pickupCode ?? ""}
            required={isPickup}
            autoComplete="off"
          />
          <TextAreaField name="note" label="Précision (facultatif)" rows={2} placeholder="Ex. : casier n° 12, disponible jusqu'au 20/11" />
        </ActionDialog>
      )}
      {early && (
        <ActionDialog
          trigger={
            <Button variant="ghost">
              <XCircle /> Annuler
            </Button>
          }
          title="Annuler cette commande ?"
          description="À utiliser si la commande fournisseur a été annulée. Votre préparateur ne l'attendra plus."
          action={updateOrderAction}
          submitLabel="Annuler la commande"
          destructive
        >
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="status" value="CANCELLED" />
          <TextAreaField name="note" label="Motif (facultatif)" rows={2} />
        </ActionDialog>
      )}
      <ActionDialog
        trigger={
          <Button variant="outline">
            <TriangleAlert /> Signaler un problème
          </Button>
        }
        title="Signaler un problème"
        description="L'équipe Packio et votre préparateur sont prévenus."
        action={reportOrderProblemAction}
        submitLabel="Envoyer"
      >
        <input type="hidden" name="orderId" value={order.id} />
        <SelectField
          name="type"
          label="Nature du problème"
          defaultValue="OTHER"
          options={[
            { value: "INBOUND_MISSING", label: "Colis perdu ou non livré" },
            { value: "LOCKER_ISSUE", label: "Problème de locker / point relais" },
            { value: "INBOUND_DAMAGED", label: "Colis endommagé" },
            { value: "WRONG_ITEM", label: "Article non conforme" },
            { value: "OTHER", label: "Autre" },
          ]}
        />
        <TextAreaField name="description" label="Description" required rows={4} />
        <FileUploader purpose="INCIDENT_ATTACHMENT" accept="image/*,application/pdf" label="Ajouter" />
      </ActionDialog>
    </div>
  );
}
