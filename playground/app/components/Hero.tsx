// Server component.
export function Hero() {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
        New for teams
      </p>
      <h1 className="text-4xl font-bold tracking-tight">
        Ship your landing page in a weekend
      </h1>
      <p className="max-w-xl text-lg text-zinc-600">
        Pick a plan that fits your team. Read the{" "}
        <a href="/docs" className="underline">
          setup guide
        </a>{" "}
        before you start.
      </p>
    </section>
  );
}
