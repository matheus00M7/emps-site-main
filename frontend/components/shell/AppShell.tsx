"use client";

import {
  Menu,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  empsNavigationItems,
  semsSidebarItems,
  semsToolbarItems,
} from "@/components/shell/shell-navigation";

function EmpsLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "emps-logo emps-logo--compact" : "emps-logo"}>
      <svg viewBox="0 0 42 42" aria-hidden="true" focusable="false">
        <path d="M9 8v26h17M10 21h15M10 8h18" />
        <path className="bolt" d="m29 10-8 13h7l-5 11 12-15h-7l5-9" />
      </svg>
    </span>
  );
}

function SemsLogo() {
  return (
    <span className="sems-logo">
      <Image
        alt=""
        aria-hidden="true"
        className="sems-logo__mark"
        height={29}
        priority
        src="/goodwe_logo_w.d807055f.png"
        width={30}
      />
      <small>SEMS+</small>
    </span>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  return pathname.startsWith(href);
}

export function AppShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [empsMenuOpen, setEmpsMenuOpen] = useState(false);
  const breadcrumb = eyebrow.startsWith("SEMS+") ? eyebrow : `SEMS+ / ${eyebrow}`;

  useEffect(() => {
    setMenuOpen(false);
    setEmpsMenuOpen(false);
  }, [pathname]);

  return (
    <div className="app-shell">
      {menuOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar navegacao"
        />
      )}

      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="brand-row">
          <Link href="/dashboard" className="rail-brand" aria-label="SEMS+">
            <SemsLogo />
          </Link>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
            title="Fechar menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Navegacao principal">
          <div className="nav-section">
            <span className="nav-section-label">SEMS+</span>
            {semsSidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="nav-item sems-shell-item"
                  onClick={() => {
                    setEmpsMenuOpen(false);
                  }}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="nav-section nav-section--emps">
            <span className="nav-section-label">EMPS</span>
            <button
              type="button"
              className={`nav-item emps-rail-trigger ${empsMenuOpen ? "nav-item--active" : ""}`}
              onClick={() => setEmpsMenuOpen((open) => !open)}
              title="Modulo EMPS"
              aria-label="Abrir modulo EMPS"
              aria-expanded={empsMenuOpen}
              aria-haspopup="menu"
            >
              <EmpsLogo compact />
              <span>EMPS</span>
            </button>
          </div>
        </nav>

        {empsMenuOpen && (
          <div className="emps-popover" role="dialog" aria-label="Modulo EMPS">
            <div className="emps-popover__list">
              {empsNavigationItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    className={`emps-popover__item ${isActive(pathname, item.href) ? "active" : ""}`}
                    href={item.href}
                    key={item.href}
                    onClick={() => {
                      setMenuOpen(false);
                      setEmpsMenuOpen(false);
                    }}
                  >
                    <span className="emps-popover__icon">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button menu-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
              title="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <div>
              <span>{breadcrumb}</span>
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </div>
          </div>

          <div className="topbar-actions" aria-label="Acoes SEMS+">
            {semsToolbarItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="sems-top-action"
                  key={item.label}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon size={19} aria-hidden="true" />
                </button>
              );
            })}
            <button className="sems-profile-button" type="button" aria-label="Perfil" title="Perfil">
              <span>EM</span>
            </button>
          </div>
        </header>

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

