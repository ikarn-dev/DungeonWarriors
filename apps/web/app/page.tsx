export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-3xl font-semibold">PURRPS</h1>
      <Link
        href="/starter"
        prefetch={false}
        className="inline-flex min-h-11 items-center rounded-md border border-current px-4 underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Open starter draw
      </Link>
    </main>
  );
}

import Link from "next/link";
