export function Toast({ message }: { message: string }) {
  return message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;
}
