export type ConversationSummary = {
  id: string;
  type: "CUSTOMER_PREPARER" | "SUPPORT";
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  title: string;
  subtitle: string;
  initials: string;
  lastMessageAt: string;
  preview: string | null;
  unread: number;
};

export type ThreadMessage = {
  id: string;
  kind: "TEXT" | "SYSTEM";
  body: string;
  createdAt: string;
  sender: { id: string; name: string; role: "CUSTOMER" | "PREPARER" | "ADMIN" } | null;
  attachments: { id: string; filename: string; mimeType: string }[];
  supplierOrder: { id: string; reference: string } | null;
  shipment: { id: string; reference: string } | null;
};

export type SelectedConversation = {
  id: string;
  type: "CUSTOMER_PREPARER" | "SUPPORT";
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  title: string;
  subtitle: string;
  canWrite: boolean;
  mode: "participant" | "support" | "supervision";
  readAt: string | null;
  messages: ThreadMessage[];
  linkables: { orders: { id: string; label: string }[]; shipments: { id: string; label: string }[] };
};
