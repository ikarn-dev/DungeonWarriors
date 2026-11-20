import Link from "next/link";
import style from "../../components/StarterExperience.module.css";
import WalletShell from "../../components/WalletShell";
export default function StarterPage() {
  return (
    <main className={style.shell}>
      <div className={style.layout}>
        <Link
          href="/"
          className={`${style.nav} focus-visible:outline-2 focus-visible:outline-offset-2`}
        >
          ← PURRPS
        </Link>
        <header className={style.heading}>
          <h1>Starter draw</h1>
          <p>Solana Devnet</p>
        </header>
        <WalletShell />
      </div>
    </main>
  );
}
