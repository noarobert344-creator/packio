export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionState<T = undefined> = ActionResult<T> | null;

export type FormAction<T = undefined> = (prev: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
