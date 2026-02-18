const HEADLINE_TEXT = 'LumenFlow Web Surface';
const BODY_TEXT =
  'This app hosts API routes that bridge Next.js handlers to the kernel HTTP surface runtime.';
const DASHBOARD_LINK_TEXT = 'Open Task Dashboard';
const DASHBOARD_DESCRIPTION =
  'View real-time task lifecycle events, tool execution receipts, and evidence chains.';
const DEMO_TASK_ID = 'demo-task';

export default function HomePage() {
  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">{HEADLINE_TEXT}</h1>
      <p className="mt-4 max-w-prose text-lg text-slate-700">{BODY_TEXT}</p>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">{DASHBOARD_LINK_TEXT}</h2>
        <p className="mt-1 text-sm text-slate-500">{DASHBOARD_DESCRIPTION}</p>
        <a
          href={`/dashboard/${DEMO_TASK_ID}`}
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Launch Dashboard
        </a>
      </div>
    </main>
  );
}
