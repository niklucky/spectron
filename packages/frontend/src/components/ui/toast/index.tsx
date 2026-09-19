export function Toast({ message }: { message: string }) {
  return message ? (
    <div
      className="fixed bottom-6 left-1/2 z-50 max-w-[min(480px,calc(100vw-32px))] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-base text-surface shadow-pop"
      role="status"
    >
      {message}
    </div>
  ) : null;
}
