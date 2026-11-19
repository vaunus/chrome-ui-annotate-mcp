import Image from "next/image";
import { Hero } from "./components/Hero";
import { PricingCard } from "./components/PricingCard";
import { Tagline } from "./components/Tagline";
import messages from "./messages/en.json";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-24">
      <Image src="/next.svg" alt="Logo" width={100} height={20} priority />
      <Hero />
      <Tagline />
      <div className="grid gap-6 sm:grid-cols-3">
        <PricingCard name="Starter" price="$9" />
        <PricingCard name="Team" price="$29" />
        <PricingCard name="Business" price="$99" />
      </div>
      <footer className="text-sm text-zinc-500">{messages.footer.legal}</footer>
    </main>
  );
}
