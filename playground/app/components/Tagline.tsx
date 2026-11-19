"use client";

import { useEffect, useState } from "react";

export function Tagline() {
  const [text, setText] = useState("");
  useEffect(() => {
    fetch("/api/tagline")
      .then((r) => r.json())
      .then((d) => setText(d.tagline));
  }, []);
  return <p className="text-sm text-zinc-500">{text}</p>;
}
