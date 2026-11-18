import Link from "next/link";
import WalletShell from "../../components/WalletShell";
export default function StarterPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center self-start underline focus-visible:outline-2"
      >
        Back to PURRPS
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Wallet and starter cat</h1>
        <p>Solana Devnet. Ownership comes from finalized onchain state.</p>
      </header>
      <WalletShell />
    </main>
  );
}
