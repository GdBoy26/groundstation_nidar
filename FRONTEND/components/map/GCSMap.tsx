import dynamic from "next/dynamic";

const GCSMap = dynamic(() => import("./GCSMapClient"), {
  ssr: false,
});

export default GCSMap;
