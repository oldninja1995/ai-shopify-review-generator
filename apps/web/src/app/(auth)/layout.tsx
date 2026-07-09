export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold">AI Shopify Review Generator</h1>
          <p className="text-sm text-muted-foreground">Realistic, brand-aware reviews on autopilot</p>
        </div>
        {children}
      </div>
    </div>
  );
}
