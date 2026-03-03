from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_v1_route_files_exist():
    required_routes = [
        FRONTEND_DIR / "app" / "page.tsx",
        FRONTEND_DIR / "app" / "spatial" / "page.tsx",
        FRONTEND_DIR / "app" / "explorer" / "page.tsx",
        FRONTEND_DIR / "app" / "absolute-data" / "page.tsx",
    ]
    for route in required_routes:
        assert route.exists(), f"Missing route file: {route}"


def test_sidebar_focuses_on_v1_routes_only():
    sidebar = _read(FRONTEND_DIR / "components" / "layout" / "Sidebar.tsx")

    assert "href: '/'" in sidebar
    assert "href: '/spatial'" in sidebar
    assert "href: '/explorer'" in sidebar
    assert "href: '/absolute-data'" in sidebar

    assert "href: '/reports'" not in sidebar
    assert "href: '/actors'" not in sidebar
    assert "href: '/early-warning'" not in sidebar


def test_map_wiring_uses_new_spatial_endpoints():
    conflict_map = _read(FRONTEND_DIR / "components" / "map" / "ConflictMap.tsx")
    spatial_page = _read(FRONTEND_DIR / "app" / "spatial" / "page.tsx")

    assert "/api/spatial/classification" in conflict_map
    assert "/api/spatial/events" in conflict_map
    assert "periods()" in spatial_page
