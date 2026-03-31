import RotatingEarth from "@/components/ui/wireframe-dotted-globe"

export default function GlobePage() {
  return (
    <main className="dark min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <h1 className="text-white text-2xl font-semibold mb-6">MLB Game Analyzer — Globe View</h1>
      <RotatingEarth width={800} height={600} className="w-full max-w-3xl" />
    </main>
  )
}
