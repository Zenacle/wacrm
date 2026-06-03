"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { label: 'New Contact', href: '/contacts', icon: UserPlus, tint: 'text-brand-cyan' },
  { label: 'New Deal', href: '/pipelines', icon: Briefcase, tint: 'text-brand-cyan' },
  { label: 'New Broadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-brand-teal dark:text-brand-cyan' },
  { label: 'New Automation', href: '/automations/new', icon: Zap, tint: 'text-brand-cyan' },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition-all hover:bg-accent hover:border-accent shadow-sm hover:shadow-md"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-accent ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-foreground">{a.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
