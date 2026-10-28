export default function SectionPlaceholder({
  title,
  bucket,
  items,
}: {
  title: string;
  bucket: string;
  items: string[];
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {bucket}
      </div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="rounded-lg border border-dashed border-border bg-card p-6">
        <p className="mb-3 text-sm text-neutral-500">Planned analyses for this section:</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-neutral-700">
              <span className="text-neutral-400">•</span>
              {i}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
