# Tork KG Var/Yok ikili karar politikası

## Üretim sözleşmesi

- Model sürümü: `tork-stage1-logistic-blend-binary-v2`.
- Karar politikası: `btts-binary-equal-cost-v1`.
- Ham olasılık: `pBtts = P(iki takım da gol atar)`.
- Her maç için ikili karar: `pBtts >= 0.50` ise **KG Var**, aksi hâlde **KG Yok**.
- Bu, eşit hata maliyeti varsayımı altındaki doğal binary başlangıç eşiğidir; %50/%50 tahmin dağılımı zorlamaz. `pBtts` hâlâ KG Var olasılığıdır. KG Yok seçim olasılığı `1 - pBtts` olarak gösterilir.
- Olasılık kalibrasyonu **doğrulanmış değildir**. Eşik değişikliği, olasılık modelinin yeniden kalibre edildiği veya sonuç garantisi verdiği anlamına gelmez.

## Eşik kararının ölçüm dayanağı

Dondurulmuş üretim TypeScript özellik/olasılık hesaplamalarıyla 2025/26 kronolojik kohortu yeniden değerlendirilmiştir. 2.591 normal süreli maçın 2.553'ünde gerekli geçmiş verisi vardı; 38 maç yetersiz takım geçmişi nedeniyle sınıflandırılmadı. Bu sezon daha önce test ve eşik taraması için incelendiğinden aşağıdaki sayılar **bağımsız yeni doğrulama ya da ileri dönem başarı iddiası değildir**.

| KG Var eşiği | Var / Yok kararı | TP | FP | TN | FN | Genel doğruluk | Dengeli doğruluk |
|---:|---:|---:|---:|---:|---:|---:|---:|
| **0.50** | 2.219 / 334 | 1.253 | 966 | 182 | 152 | **%56,21** | %52,52 |
| 0.55 | 1.184 / 1.369 | 694 | 490 | 658 | 711 | %52,96 | **%53,36** |
| 0.58 | 457 / 2.096 | 274 | 183 | 965 | 1.131 | %48,53 | %51,78 |
| 0.60 | 164 / 2.389 | 103 | 61 | 1.087 | 1.302 | %46,61 | %51,01 |
| 0.76 | 0 / 2.553 | 0 | 0 | 1.148 | 1.405 | %44,97 | %50,00 |

`0.55` eşiğinde bildirilen yaklaşık `%58,6`, seçilen **KG Var** maçlarının precision değeridir; tüm maçlardaki ikili doğruluk değildir. 0.50 ile 0.55 arasındaki karar farkında 1.035 maçın 559'u Var, 476'sı Yok çıktı. Buna rağmen her maça KG Var demek kohortta `%55,03` doğruluk verdi; 0.50'nin bu basit tabana farkı yalnız 1,18 yüzde puandır.

Olasılıkların AUC'si `0.5522` idi; ayırt etme gücü sınırlıdır. 0.50 kararı bu nedenle yalnız **her maç için binary seçim + eşit hata maliyeti** varsayımı altında seçilmiş uygulanabilir başlangıçtır. Daha yüksek KG Var precision'ı veya seçici güçlü sinyal hedefi için aynı eşik optimum olduğu iddia edilmez.

## Geçiş ve geçmiş kayıtları

- Eski model sürümünde yayımlanmış seçimler ve yerleşmiş sonuçlar değiştirilmez. Eski bir `KG Yok` seçimi, yeni eşik onu Var sınıflandıracak olsa dahi tarihsel tahmin olarak kalır.
- Yeni politika farklı model sürümü ve hash ile yayımlanır; yeni satır eski tahmin kimliğine `supersedes_id` ile bağlanabilir. API maç başına tek, geçerli ve en son yayımlanmış kaydı seçer.
- Kart, kupon ve sonuç görünümü yayımlanmış `pick` değerini esas alır. Negatif seçimin olasılığı `1 - pBtts` olur; metin KG Yok'u “iki takım da gol atmaz” şeklinde yanlış tarif etmez.
- Geçmiş simülasyon backfill'i artık otomatik açılış/günlük iş değildir. Backfill sorguları tahmin veya sonuç satırlarını silmez; yalnız eksik simülasyonu idempotent biçimde ekleyebilir.

## İleri değerlendirme

Kalibrasyon, eşik seçimi ve başarı değerlendirmesi yeni sezonun zaman sıralı verisinde ayrı dönemler kullanılarak yapılmalıdır. Sonraki raporlar iki sınıfın precision/recall ve confusion matrix'ini, coverage'ı, log-loss/Brier/kalibrasyonu ve lig bazlı örnek büyüklüklerini birlikte göstermelidir. Yeterli yeni ileri dönem veri oluşana kadar ağırlıklar veya olasılık kalibratörü değiştirilmemeli ve başarı vaadi yapılmamalıdır.
