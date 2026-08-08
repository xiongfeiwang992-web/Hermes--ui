type Handler = (payload: any) => void;

const handlers = new Map<string, Handler[]>();

export function on(event: string, handler: Handler): void {
  const list = handlers.get(event) || [];
  list.push(handler);
  handlers.set(event, list);
}

export function emit(event: string, payload: any): void {
  for (const h of handlers.get(event) || []) {
    h(payload);
  }
}
