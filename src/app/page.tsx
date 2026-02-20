import { Suspense } from "react";
import HomeClient from "@/components/home-client";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <HomeClient />
    </Suspense>
  );
}
