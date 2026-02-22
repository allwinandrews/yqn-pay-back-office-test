"use client";

import dynamic from "next/dynamic";

const HomeClient = dynamic(() => import("@/components/home-client"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-slate-50" />,
});

export default function HomeClientShell() {
  return <HomeClient />;
}
