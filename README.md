# Elsharkawy Dental Clinic

مشروع تطبيق العيادة — Capacitor 6 + واجهة عربية RTL.

- Package ID: `com.elsharkawy.dental` (ثابت بعد أول تثبيت).
- مزامنة بيانات العيادة عبر Supabase Edge Function `clinic-sync` باستخدام PIN مشترك؛ لا توجد حسابات بريد إلكتروني.
- المستودع Public؛ لذلك الكود والأسعار وتعليمات البناء مرئية للجميع.
- ممنوع رفع بيانات المرضى أو النسخ الاحتياطية أو مفاتيح `service_role` أو كلمات مرور التوقيع إلى GitHub.

## Supabase
Project ref: `iqvuosxqdhnqnadvpcwe`.
شغّلي `supabase/schema.sql` ثم انشري `supabase/functions/clinic-sync/index.ts` باسم `clinic-sync` مع `verify_jwt=false`. مفاتيح الخدمة تبقى داخل Supabase فقط.

## APK
GitHub Actions workflow يبني APK تجريبي Debug. لا تستخدميه كتحديث دائم. التحديث فوق التطبيق المثبت يتطلب نفس مفتاح Release ونفس Package ID. لا توجد keystore في ملف ZIP الأصلي؛ يجب إنشاء مفتاح Release واحد وحفظه وإضافته إلى Actions Secrets قبل أول تثبيت نهائي.

لا تدخلي بيانات مرضى حقيقية قبل اختبار المزامنة والإضافة والتعديل والحذف على جهازين.