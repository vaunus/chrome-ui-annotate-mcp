"use client";

import { useEffect, useState } from "react";

// Test case: text built at run time. "localhost:3100" is not in the code,
// so a copy edit on it must fail cleanly.
export function HostNote() {
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  if (!host) return null;
  return <p className="text-xs text-zinc-400">Running on {host}</p>;
}
