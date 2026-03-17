import { createFileRoute } from "@tanstack/react-router"

const HomePage = () => (
  <div className="flex min-h-screen items-center justify-center bg-gray-50">
    <div className="text-center">
      <h1 className="text-4xl font-bold text-red-500">Etyon</h1>
      <p className="mt-2 text-lg text-gray-600">
        Welcome to your Electron application.
      </p>
    </div>
  </div>
)

export const Route = createFileRoute("/")({
  component: HomePage
})
