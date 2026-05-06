export function SummaryPanel({ body }: { body: string }) {
  return (
    <section className="panel">
      <h2>Summary</h2>
      <p>{body}</p>
    </section>
  );
}
