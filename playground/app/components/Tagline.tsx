"use client";

import { useEffect, useState } from "react";

export function Tagline() {
  const [text, setText] = useState("");
  useEffect(() => {
    fetch("/api/tagline")
      .then((r) => r.json())
      .then((d) => setText(d.tagline));
  }, []);
  return (
    <p className="w-fit rounded-full border-2 border-purple-300 bg-purple-600 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/30 empty:hidden">
      {text}
    </p>
  );
}
