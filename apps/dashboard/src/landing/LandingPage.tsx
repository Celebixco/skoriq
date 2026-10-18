import { ArenaHome } from "../arena/ArenaHome";
import { PublicArenaShell } from "../arena/ArenaNavigation";

export function LandingPage({ navigate }: { navigate: (path: string) => void }) {
  return <PublicArenaShell navigate={navigate}>
    <ArenaHome navigate={navigate} authenticated={false} overview={{ data: null, loading: false, error: null }} />
    <footer className="arena-public-footer"><span>© {new Date().getFullYear()} SkorIQ</span><div><button type="button" onClick={() => navigate("/login")}>Giriş yap</button><button type="button" onClick={() => navigate("/register")}>Ücretsiz hesap oluştur</button></div><p>SkorIQ, istatistiksel modelleme ve veri destekli analizlerle hazırlanır.</p></footer>
  </PublicArenaShell>;
}
