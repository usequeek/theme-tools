import { notFound } from 'next/navigation';
import { loadStore } from '../../_lib/stores';
import { ThemePage } from '../../theme-page';
/** `/shop` — the whole catalogue. Your Shop page loads products itself through `useShop`. */
export default async function Shop({ params }) {
    const { store } = await params;
    const demo = loadStore(store);
    if (!demo)
        notFound();
    const products = demo.products ?? [];
    const categories = (demo.categories ?? []).map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        image: category.image ?? null,
        products_count: products.filter((product) => product.categories.some((item) => item.slug === category.slug)).length,
    }));
    return <ThemePage name="Shop" props={{ categories }}/>;
}
