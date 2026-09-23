import { LoadingSpinner } from "./loading-spinner"

interface PageLoaderProps {
  message?: string
}

export function PageLoader({ message = "Loading" }: PageLoaderProps) {
  return (
    <div className="flex min-h-screen items-center justify-center flex-col gap-2">
      <LoadingSpinner size="sm" />
      <p className="text-muted-foreground leading-tight text-sm font-medium relative after:absolute after:left-full after:content-['...']">{message}</p>
    </div>
  )
}
