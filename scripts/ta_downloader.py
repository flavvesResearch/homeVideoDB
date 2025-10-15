#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
import re
import sys
import time
import urllib.parse
import zipfile
from typing import List, Dict, Optional

try:
    import requests
    from bs4 import BeautifulSoup  # type: ignore
except Exception as e:
    print("This script requires 'requests' and 'beautifulsoup4'. Install with:", file=sys.stderr)
    print("    pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)


BASE = "https://turkcealtyazi.org"


def build_session(timeout: int = 20) -> requests.Session:
    s = requests.Session()
    # Reasonable headers to look like a browser and keep referer
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Connection": "keep-alive",
    })
    # Attach default timeout to session via a simple wrapper
    s.request = _with_timeout(s.request, timeout)  # type: ignore
    return s


def _with_timeout(request_func, default_timeout):
    """Wrap requests.Session.request to inject a default timeout if not provided."""
    def wrapped(method, url, **kwargs):
        if "timeout" not in kwargs:
            kwargs["timeout"] = default_timeout
        return request_func(method, url, **kwargs)
    return wrapped


def search_query(session: requests.Session, query: str) -> str:
    params = {"cat": "sub", "find": query}
    url = f"{BASE}/find.php"
    resp = session.get(url, params=params)
    resp.raise_for_status()
    return resp.text



def parse_Subs(html: str) -> List[Dict[str, str]]:
    """
    HTML'den altyazı bilgilerini parse eder.
    Her altyazı için şu bilgileri döndürür:
    - url: Altyazı adresi (/sub/ ile başlayan)
    - title: Altyazı başlığı
    - language: 'tr' veya 'en'
    - translator: Çevirmen bilgisi (varsa)
    - downloads: İndirme sayısı (integer)
    - downloads_formatted: Formatlanmış indirme sayısı (string, virgüllü)
    """
    soup = BeautifulSoup(html, "html.parser")
    subtitles = []
    
    # Altyazı satırlarını bul (genellikle div class içinde)
    subtitle_rows = soup.find_all("div", class_=re.compile(r"altsonsez|row-class"))
    
    for row in subtitle_rows:
        try:
            subtitle_info = {}
            
            # Altyazı linkini bul
            link_element = row.find("a", href=re.compile(r"\d+/.*\.html"))
            if not link_element:
                continue
                
            href = link_element.get("href", "")
            if href:
                # href zaten /sub/ ile başlıyorsa olduğu gibi bırak, yoksa ekle
                if not href.startswith("/sub/"):
                    subtitle_info["url"] = "/sub/" + href.lstrip("/")
                else:
                    subtitle_info["url"] = href
                    
                # Başlığı al
                title_text = link_element.get_text(strip=True)
                subtitle_info["title"] = title_text if title_text else "Bilinmeyen Altyazı"
            
            # Dil bilgisini bul (flag sınıfından)
            flag_element = row.find("span", class_=re.compile(r"flag(tr|en)"))
            if flag_element:
                flag_class = flag_element.get("class", [])
                if "flagtr" in flag_class:
                    subtitle_info["language"] = "tr"
                elif "flagen" in flag_class:
                    subtitle_info["language"] = "en"
                else:
                    subtitle_info["language"] = "unknown"
            else:
                subtitle_info["language"] = "unknown"
            
            # Çevirmen bilgisini bul
            translator_div = row.find("div", class_="alcevirmen")
            if translator_div:
                translator_links = translator_div.find_all("a")
                translators = []
                for t_link in translator_links:
                    t_text = t_link.get_text(strip=True)
                    if t_text:
                        translators.append(t_text)
                subtitle_info["translator"] = " & ".join(translators) if translators else "Bilinmiyor"
            else:
                subtitle_info["translator"] = "Bilinmiyor"
            
            # İndirme sayısını bul
            download_div = row.find("div", class_="alindirme")
            if download_div:
                download_text = download_div.get_text(strip=True)
                # Virgül ve nokta karakterlerini temizleyerek sayıya çevir
                try:
                    download_count = download_text.replace(",", "").replace(".", "")
                    subtitle_info["downloads"] = int(download_count) if download_count.isdigit() else 0
                    subtitle_info["downloads_formatted"] = download_text
                except:
                    subtitle_info["downloads"] = 0
                    subtitle_info["downloads_formatted"] = "0"
            else:
                subtitle_info["downloads"] = 0
                subtitle_info["downloads_formatted"] = "0"
            
            # Eğer temel bilgiler varsa listeye ekle
            if "url" in subtitle_info and "title" in subtitle_info:
                subtitles.append(subtitle_info)
                
        except Exception as e:
            # Bir satırda hata olursa diğerlerine devam et
            continue
    
    return subtitles

def get_Most_Downloaded_Subtitle(subtitles: List[Dict[str, str]]) -> Dict[str, Optional[Dict[str, str]]]:
    """
    En çok indirilen Türkçe ve İngilizce altyazıları döndürür.
    Döndürülen sözlük formatı:
    {
        'turkish': {...} veya None,
        'english': {...} veya None
    }
    """
    if not subtitles:
        return {"turkish": None, "english": None}
    
    # Türkçe altyazıları filtrele
    turkish_subs = [sub for sub in subtitles if sub.get("language") == "tr"]
    # İngilizce altyazıları filtrele
    english_subs = [sub for sub in subtitles if sub.get("language") == "en"]
    
    # En çok indirilen Türkçe altyazı
    most_downloaded_turkish = None
    if turkish_subs:
        most_downloaded_turkish = max(turkish_subs, key=lambda x: x.get("downloads", 0))
    
    # En çok indirilen İngilizce altyazı
    most_downloaded_english = None
    if english_subs:
        most_downloaded_english = max(english_subs, key=lambda x: x.get("downloads", 0))
    
    return {
        "turkish": most_downloaded_turkish,
        "english": most_downloaded_english
    }


def fetch_subtitle_page(session: requests.Session, subtitle_url: str) -> str:
    """
    Altyazı sayfasına istek atıp HTML'i döndürür.
    subtitle_url: /sub/735846/avengers-endgame.html gibi
    """
    if not subtitle_url.startswith("/"):
        subtitle_url = "/" + subtitle_url
    
    full_url = BASE + subtitle_url
    resp = session.get(full_url)
    resp.raise_for_status()
    return resp.text


def process_most_downloaded_subtitles(session: requests.Session, most_downloaded_result: Dict[str, Optional[Dict[str, str]]]) -> Dict[str, Optional[str]]:
    """
    En çok indirilen altyazıların sayfalarına istek atıp HTML'lerini getirir.
    
    Args:
        session: HTTP session
        most_downloaded_result: get_Most_Downloaded_Subtitle fonksiyonundan gelen sonuç
        
    Returns:
        {
            'turkish_html': HTML string veya None,
            'english_html': HTML string veya None
        }
    """
    result: Dict[str, Optional[str]] = {
        "turkish_html": None,
        "english_html": None
    }
    
    # Türkçe altyazı sayfasını getir
    turkish_sub = most_downloaded_result.get("turkish")
    if turkish_sub is not None:
        try:
            turkish_url = turkish_sub["url"]
            print(f"Türkçe altyazı sayfası getiriliyor: {turkish_url}")
            result["turkish_html"] = fetch_subtitle_page(session, turkish_url)
            print("✓ Türkçe sayfa başarıyla getirildi")
        except Exception as e:
            print(f"✗ Türkçe sayfa getirilemedi: {e}")
    
    # İngilizce altyazı sayfasını getir
    english_sub = most_downloaded_result.get("english")
    if english_sub is not None:
        try:
            english_url = english_sub["url"]
            print(f"İngilizce altyazı sayfası getiriliyor: {english_url}")
            result["english_html"] = fetch_subtitle_page(session, english_url)
            print("✓ İngilizce sayfa başarıyla getirildi")
        except Exception as e:
            print(f"✗ İngilizce sayfa getirilemedi: {e}")
    
    return result


def parse_download_forms(html: str) -> List[Dict[str, str]]:
    """
    Altyazı sayfasındaki download formlarını parse eder.
    
    Returns:
        [{'idid': '736104', 'altid': '735915', 'sidid': '98f7497f2cc091a94da701cf1bb09aac'}, ...]
    """
    if not html:
        return []
    
    soup = BeautifulSoup(html, "html.parser")
    forms = []
    
    # action="/ind" olan formları bul
    download_forms = soup.find_all("form", attrs={"action": "/ind"})
    
    for form in download_forms:
        idid_input = form.find("input", attrs={"name": "idid"})
        altid_input = form.find("input", attrs={"name": "altid"}) 
        sidid_input = form.find("input", attrs={"name": "sidid"})
        
        if idid_input and altid_input and sidid_input:
            form_data = {
                "idid": idid_input.get("value", ""),
                "altid": altid_input.get("value", ""),
                "sidid": sidid_input.get("value", "")
            }
            forms.append(form_data)
    
    return forms


def download_from_page_results(session: requests.Session, page_results: Dict[str, Optional[str]], out_dir: str = "./subs") -> Dict[str, Optional[str]]:
    """
    page_results içindeki HTML'lerden form bilgilerini çıkarıp indirme yapar.
    
    Returns:
        {
            'turkish_file': dosya yolu veya None,
            'english_file': dosya yolu veya None
        }
    """
    result: Dict[str, Optional[str]] = {
        "turkish_file": None,
        "english_file": None
    }
    
    # Türkçe altyazı için
    turkish_html = page_results.get("turkish_html")
    if turkish_html is not None:
        try:
            print("🇹🇷 Türkçe altyazı form bilgileri çıkarılıyor...")
            turkish_forms = parse_download_forms(turkish_html)
            
            if turkish_forms:
                # İlk formu kullan (genellikle tek form var)
                form_data = turkish_forms[0]
                print(f"   Form bilgileri: idid={form_data['idid']}, altid={form_data['altid']}")
                
                # POST request at
                url = f"{BASE}/ind"
                headers = {
                    "Referer": f"{BASE}/sub/{form_data['altid']}/",
                    "Origin": BASE,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
                
                with session.post(url, data=form_data, headers=headers, stream=True) as r:
                    r.raise_for_status()
                    
                    # Dosya adını belirle
                    cd = r.headers.get("Content-Disposition", "")
                    filename = None
                    m = re.search(r'filename="?([^"]+)"?', cd)
                    if m:
                        filename = m.group(1)
                    else:
                        filename = f"turkish_{form_data['altid']}.zip"
                    
                    # Dosyayı kaydet
                    os.makedirs(out_dir, exist_ok=True)
                    filepath = os.path.join(out_dir, sanitize_filename(filename))
                    
                    with open(filepath, "wb") as f:
                        for chunk in r.iter_content(chunk_size=8192):
                            if chunk:
                                f.write(chunk)
                    
                    result["turkish_file"] = filepath
                    print(f"✓ Türkçe altyazı indirildi: {filepath}")
            else:
                print("✗ Türkçe sayfada form bulunamadı")
                
        except Exception as e:
            print(f"✗ Türkçe altyazı indirilemedi: {e}")
    
    # İngilizce altyazı için
    english_html = page_results.get("english_html")
    if english_html is not None:
        try:
            print("🇺🇸 İngilizce altyazı form bilgileri çıkarılıyor...")
            english_forms = parse_download_forms(english_html)
            
            if english_forms:
                # İlk formu kullan
                form_data = english_forms[0]
                print(f"   Form bilgileri: idid={form_data['idid']}, altid={form_data['altid']}")
                
                # POST request at
                url = f"{BASE}/ind"
                headers = {
                    "Referer": f"{BASE}/sub/{form_data['altid']}/",
                    "Origin": BASE,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
                
                with session.post(url, data=form_data, headers=headers, stream=True) as r:
                    r.raise_for_status()
                    
                    # Dosya adını belirle
                    cd = r.headers.get("Content-Disposition", "")
                    filename = None
                    m = re.search(r'filename="?([^"]+)"?', cd)
                    if m:
                        filename = m.group(1)
                    else:
                        filename = f"english_{form_data['altid']}.zip"
                    
                    # Dosyayı kaydet
                    os.makedirs(out_dir, exist_ok=True)
                    filepath = os.path.join(out_dir, sanitize_filename(filename))
                    
                    with open(filepath, "wb") as f:
                        for chunk in r.iter_content(chunk_size=8192):
                            if chunk:
                                f.write(chunk)
                    
                    result["english_file"] = filepath
                    print(f"✓ İngilizce altyazı indirildi: {filepath}")
            else:
                print("✗ İngilizce sayfada form bulunamadı")
                
        except Exception as e:
            print(f"✗ İngilizce altyazı indirilemedi: {e}")
    
    return result   

def parse_candidates(html: str) -> List[Dict[str, str]]:
    """
    Parse result page and extract candidates: {idid, altid, sidid, title?}
    We try to detect a nearby title for each form; if not found, title stays generic.
    """
    
    
    
    soup = BeautifulSoup(html, "html.parser")
    candidates: List[Dict[str, str]] = []
    forms = soup.find_all("form", attrs={"action": "/ind"})
    for f in forms:
        idid = f.find("input", attrs={"name": "idid"})
        altid = f.find("input", attrs={"name": "altid"})
        sidid = f.find("input", attrs={"name": "sidid"})
        if not (idid and altid and sidid):
            continue
        # Try to guess a readable title by looking around the form
        title = None
        # Check preceding sibling or a parent block for a link/text
        parent = f.parent
        # Look for a link with a movie/episode title near the form
        title_link = None
        # Strategy: search up to 2 levels up for an <a> with text
        for node in [f, parent, getattr(parent, "parent", None)]:
            if not node:
                continue
            title_link = node.find("a")
            if title_link and title_link.get_text(strip=True):
                break
        if title_link and title_link.get_text(strip=True):
            title = title_link.get_text(strip=True)
        else:
            # fallback: try to extract any strong/b tag nearby
            title_tag = None
            for node in [f, parent, getattr(parent, "parent", None)]:
                if not node:
                    continue
                title_tag = node.find(["strong", "b", "h3", "h4"])
                if title_tag and title_tag.get_text(strip=True):
                    break
            title = (title_tag.get_text(strip=True) if title_tag else "Subtitle candidate")

        candidates.append({
            "idid": idid.get("value", ""),
            "altid": altid.get("value", ""),
            "sidid": sidid.get("value", ""),
            "title": title or "Subtitle candidate"
        })
    return candidates


def download_subtitle(session: requests.Session,
                      payload: Dict[str, str],
                      referer: str,
                      out_dir: str) -> str:
    """
    POST /ind with payload to get the file content.
    Returns the saved file path.
    """
    url = f"{BASE}/ind"
    # Referer matters on some sites
    headers = {
        "Referer": referer,
        "Origin": BASE,
    }
    with session.post(url, data=payload, headers=headers, stream=True, allow_redirects=True) as r:
        r.raise_for_status()
        # Content-Disposition usually includes filename
        cd = r.headers.get("Content-Disposition", "")
        filename = None
        m = re.search(r'filename="?([^"]+)"?', cd)
        if m:
            filename = m.group(1)
        else:
            # fallback
            filename = f"{payload.get('idid','file')}_{payload.get('altid','sub')}.zip"

        # Ensure output directory
        os.makedirs(out_dir, exist_ok=True)
        filepath = os.path.join(out_dir, sanitize_filename(filename))

        # Write stream
        with open(filepath, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
    return filepath


def sanitize_filename(name: str) -> str:
    name = name.replace("\r", "").replace("\n", "").strip()
    # Remove characters not friendly to filesystems
    return re.sub(r'[\\/*?:"<>|]+', "_", name)


def extract_and_cleanup_archives(download_results: Dict[str, Optional[str]], query: str) -> Dict[str, List[str]]:
    """
    ZIP arşivlerini çıkartır, dosyaları yeniden adlandırır ve arşiv dosyalarını siler.
    
    Args:
        download_results: download_from_page_results fonksiyonundan gelen sonuç
        query: Arama sorgusu (dosya adlandırma için kullanılır)
        
    Returns:
        {
            'turkish_files': [çıkarılan dosya yolları] veya [],
            'english_files': [çıkarılan dosya yolları] veya []
        }
    """
    result = {
        "turkish_files": [],
        "english_files": []
    }
    
    # Sorguyu dosya adı için temizle
    clean_query = sanitize_filename(query.strip().lower().replace(" ", "_"))
    
    # Türkçe arşivi işle
    turkish_file = download_results.get("turkish_file")
    if turkish_file is not None:
        try:
            print(f"🇹🇷 Türkçe arşiv çıkartılıyor: {os.path.basename(turkish_file)}")
            
            # Çıkartma klasörü (arşiv dosyasının yanında)
            extract_dir = os.path.join(os.path.dirname(turkish_file), "turkish_subtitles")
            os.makedirs(extract_dir, exist_ok=True)
            
            # ZIP dosyasını çıkart
            with zipfile.ZipFile(turkish_file, 'r') as zip_ref:
                # Dosya listesini al
                file_list = zip_ref.namelist()
                print(f"   Arşivde {len(file_list)} dosya bulundu")
                
                # Dosyaları çıkart
                zip_ref.extractall(extract_dir)
                
                # Çıkarılan dosyaları yeniden adlandır
                extracted_files = []
                subtitle_counter = 0
                
                for file_name in file_list:
                    old_path = os.path.join(extract_dir, file_name)
                    
                    if os.path.isfile(old_path):  # Sadece dosyaları işle
                        # Dosya uzantısını kontrol et
                        file_ext = os.path.splitext(file_name)[1].lower()
                        
                        if file_ext == '.srt':
                            # SRT dosyalarını yeniden adlandır
                            if subtitle_counter == 0:
                                new_name = f"{clean_query}.tr.srt"
                            else:
                                new_name = f"{clean_query}.tr.{subtitle_counter + 1}.srt"
                            subtitle_counter += 1
                        else:
                            # Diğer dosyalar için orijinal adı kullan (readme.txt gibi)
                            new_name = f"{clean_query}.tr.{file_name}"
                        
                        new_path = os.path.join(extract_dir, new_name)
                        
                        # Dosyayı yeniden adlandır
                        os.rename(old_path, new_path)
                        extracted_files.append(new_path)
                        print(f"   ✓ {file_name} → {new_name}")
                
                result["turkish_files"] = extracted_files
            
            # Arşiv dosyasını sil
            os.remove(turkish_file)
            print(f"   🗑️ Arşiv dosyası silindi: {os.path.basename(turkish_file)}")
            
        except Exception as e:
            print(f"   ✗ Türkçe arşiv işlenirken hata: {e}")
    
    # İngilizce arşivi işle
    english_file = download_results.get("english_file")
    if english_file is not None:
        try:
            print(f"🇺🇸 İngilizce arşiv çıkartılıyor: {os.path.basename(english_file)}")
            
            # Çıkartma klasörü
            extract_dir = os.path.join(os.path.dirname(english_file), "english_subtitles")
            os.makedirs(extract_dir, exist_ok=True)
            
            # ZIP dosyasını çıkart
            with zipfile.ZipFile(english_file, 'r') as zip_ref:
                # Dosya listesini al
                file_list = zip_ref.namelist()
                print(f"   Arşivde {len(file_list)} dosya bulundu")
                
                # Dosyaları çıkart
                zip_ref.extractall(extract_dir)
                
                # Çıkarılan dosyaları yeniden adlandır
                extracted_files = []
                subtitle_counter = 0
                
                for file_name in file_list:
                    old_path = os.path.join(extract_dir, file_name)
                    
                    if os.path.isfile(old_path):  # Sadece dosyaları işle
                        # Dosya uzantısını kontrol et
                        file_ext = os.path.splitext(file_name)[1].lower()
                        
                        if file_ext == '.srt':
                            # SRT dosyalarını yeniden adlandır
                            if subtitle_counter == 0:
                                new_name = f"{clean_query}.en.srt"
                            else:
                                new_name = f"{clean_query}.en.{subtitle_counter + 1}.srt"
                            subtitle_counter += 1
                        else:
                            # Diğer dosyalar için orijinal adı kullan
                            new_name = f"{clean_query}.en.{file_name}"
                        
                        new_path = os.path.join(extract_dir, new_name)
                        
                        # Dosyayı yeniden adlandır
                        os.rename(old_path, new_path)
                        extracted_files.append(new_path)
                        print(f"   ✓ {file_name} → {new_name}")
                
                result["english_files"] = extracted_files
            
            # Arşiv dosyasını sil
            os.remove(english_file)
            print(f"   🗑️ Arşiv dosyası silindi: {os.path.basename(english_file)}")
            
        except Exception as e:
            print(f"   ✗ İngilizce arşiv işlenirken hata: {e}")
    
    return result




def main():
    parser = argparse.ArgumentParser(description="turkcealtyazi.org simple subtitle downloader")
    parser.add_argument("--query", "-q", required=False, help="Film/dizi arama ifadesi (örn. 'avengers endgame')", default="avengers endgame")
    parser.add_argument("--out", "-o", default="./subs", help="Çıktı klasörü")
    parser.add_argument("--delay", type=float, default=1.0, help="İstekler arası kibar bekleme (saniye)")
    args = parser.parse_args()

    session = build_session()
    # Step 1: search page
    html = search_query(session, args.query)
    time.sleep(args.delay)


    # Step 2: parse forms
    candidates = parse_Subs(html)
    if not candidates:
        print("Aday bulunamadı. Arama ifadenizi değiştirin veya sayfa yapısı değişmiş olabilir.", file=sys.stderr)
        sys.exit(2)

    # get most download subs.

    most_downloaded_result = get_Most_Downloaded_Subtitle(candidates)
    
    # get results from most downloaded
    
    page_results = process_most_downloaded_subtitles(session, most_downloaded_result)
    time.sleep(args.delay)
    
    # Download from page results
    print("\n=== En Çok İndirilen Altyazıları İndirme ===")
    # args.out = "./most_downloaded_subs"
    download_results = download_from_page_results(session, page_results, args.out)
    
    if download_results["turkish_file"]:
        print(f"🎉 Türkçe altyazı başarıyla indirildi!")
    
    if download_results["english_file"]:
        print(f"🎉 İngilizce altyazı başarıyla indirildi!")
    
    if not download_results["turkish_file"] and not download_results["english_file"]:
        print("❌ Hiçbir altyazı indirilemedi!")
        return

    # Arşivleri çıkart ve temizle
    print("\n=== Arşivleri Çıkartma ve Temizleme ===")
    extracted_results = extract_and_cleanup_archives(download_results, args.query)
    
    print("\n🎉 İşlem Tamamlandı!")
    if extracted_results["turkish_files"]:
        print(f"🇹🇷 Türkçe altyazı dosyaları:")
        for file_path in extracted_results["turkish_files"]:
            print(f"   📄 {os.path.basename(file_path)}")
    
    if extracted_results["english_files"]:
        print(f"🇺🇸 İngilizce altyazı dosyaları:")
        for file_path in extracted_results["english_files"]:
            print(f"   📄 {os.path.basename(file_path)}")
    
    total_files = len(extracted_results["turkish_files"]) + len(extracted_results["english_files"])
    print(f"\nToplam {total_files} altyazı dosyası hazır!")
    

    

if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"HTTP hata: {e} - Yanıt: {getattr(e.response, 'status_code', 'N/A')}", file=sys.stderr)
        sys.exit(3)
    except Exception as e:
        print(f"Hata: {e}", file=sys.stderr)
        sys.exit(4)
