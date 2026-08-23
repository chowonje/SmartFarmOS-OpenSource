export type NavigationItem = {
  readonly route: string;
  readonly label: string;
  readonly testId: string | undefined;
};

type NavigationTabsProps = {
  readonly route: string;
  readonly items: readonly NavigationItem[];
  readonly onNavigate: (route: string) => void;
};

export function NavigationTabs({ route, items, onNavigate }: NavigationTabsProps) {
  return (
    <nav className="panel-block nav-card" aria-label="주요 화면">
      <div className="nav-list">
        {items.map((item) => (
          <a
            key={item.route}
            href={`#${item.route}`}
            className={`nav-link ${route === item.route ? "is-active" : ""}`}
            aria-current={route === item.route ? "page" : undefined}
            data-testid={item.testId}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(item.route);
            }}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
