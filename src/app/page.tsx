import { Suspense } from "react";
import HomeClient from "@/components/home-client";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <HomeClient />
    </Suspense>
  );
}
