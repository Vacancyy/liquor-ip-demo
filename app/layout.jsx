import "./reset.css";

export const metadata = {
  title: "酒类侵权线索智能研判工作台",
  description: "上传图片，自动给出酒类知识产权线索初筛结论"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
