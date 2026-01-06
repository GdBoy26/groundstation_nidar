"use client"

import { useState } from "react"

export function ActionButtons() {
  const [isLaunched, setIsLaunched] = useState(false)

  return (
    <div className="bg-[#1a1a2e] py-2 px-4 flex justify-center gap-8 h-16 items-center flex-shrink-0">
      <button
        onClick={() => setIsLaunched(true)}
        className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-12 rounded border-2 border-green-400 transition-all hover:scale-105"
      >
        START LAUNCH
      </button>
      <button
        onClick={() => setIsLaunched(false)}
        className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-12 rounded border-2 border-orange-400 transition-all hover:scale-105"
      >
        ABORT MISSION
      </button>
    </div>
  )
}
