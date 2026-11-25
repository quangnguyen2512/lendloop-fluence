"use client";

import { Lock, ShieldCheck, Wrench } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/domain";
import type { PublicToolProjection } from "@/lib/types";

interface PublicCatalogProps {
  tools: PublicToolProjection[];
  loading: boolean;
  signInCta: React.ReactNode;
}

/**
 * Unauthenticated Public View.
 * Data minimization: receives and renders STRICTLY `name` and `category` of
 * available tools — zero owner identities, emails, descriptions, or PII.
 */
export function PublicCatalog({
  tools,
  loading,
  signInCta,
}: PublicCatalogProps) {
  return (
    <main className="container">
      <section className="hero">
        <div className="hero-card">
          <div>
            <span className="hero-eyebrow">
              <Wrench size={13} aria-hidden="true" />
              Neighborhood Tool Library
            </span>
            <h1>Borrow what you need. Lend what you don&apos;t.</h1>
            <p>
              Browse tools currently available across your neighborhood. Sign in
              to view condition details, list tools from your garage or kitchen,
              and coordinate borrow dates safely.
            </p>
            <div>{signInCta}</div>
          </div>

          <aside className="privacy-callout" aria-label="Privacy guarantee">
            <h3>
              <ShieldCheck size={17} aria-hidden="true" />
              Privacy-first public catalog
            </h3>
            <p>
              Before sign-in, the backend query projection returns{" "}
              <strong>only tool names and categories</strong> for available
              items. Owner identities, emails, and active loan schedules never
              leave the server on public endpoints.
            </p>
          </aside>
        </div>
      </section>

      <section className="section" aria-labelledby="available-tools-heading">
        <div className="section-header">
          <div>
            <h2 id="available-tools-heading">Available Tools Nearby</h2>
            <p className="section-sub">
              Read-only public preview ({tools.length} currently available)
            </p>
          </div>
          <span className="badge badge-neutral">
            <Lock size={12} aria-hidden="true" />
            Name &amp; Category Only
          </span>
        </div>

        {loading ? (
          <div className="empty-state">Loading available tools…</div>
        ) : tools.length === 0 ? (
          <div className="empty-state">
            No tools are currently available. Sign in to list the first tool!
          </div>
        ) : (
          <div className="grid-cards">
            {tools.map((tool) => (
              <article key={tool.id} className="card">
                <div className="card-meta">
                  <span className="badge badge-available">Available</span>
                  <span className="badge badge-neutral">
                    {CATEGORY_LABELS[tool.category]}
                  </span>
                </div>
                <h3 className="card-title">{tool.name}</h3>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
