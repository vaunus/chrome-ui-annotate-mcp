"use client";

import { useState } from "react";

// Client component. Three of these render a repeated "Sign up" button.
export function PricingCard({ name, price }: { name: string; price: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-6">
      <h2 className="text-xl font-semibold">{name}</h2>
      <p className="text-3xl font-bold">{price}</p>
      <button
        onClick={() => setSaved(true)}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-white"
      >
        {saved ? "Saved" : "Sign up"}
      </button>
    </div>
  );
}
