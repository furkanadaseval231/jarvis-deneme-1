def ogrenci_ortalamasi(notlar):
    toplam = 0
    for n in notlar:
        toplam += n
    if not notlar:
        return 0
    return toplam / len(notlar)


print(ogrenci_ortalamasi([]))
