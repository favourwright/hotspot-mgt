export default function TenantNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-2">Portal Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The hotspot portal you are looking for does not exist. Check the URL
          and try again.
        </p>
        <a href="/" className="text-primary underline underline-offset-4">
          Go to homepage
        </a>
      </div>
    </div>
  );
}
