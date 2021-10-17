import { useRef, useState, useEffect } from "react";

import DynamicSizeList from "./DynamicSizeList";

const randomParagraph = require("random-paragraph");

const textContainerStyle = {
  backgroundColor: "grey",
};

const textFieldStyle = {
  padding: "5px",
  color: "white",
  overflow: "auto",
  wordWrap: "break-word",
  border: "2px solid red"
};

function createParagraphs(count) {
  const paragraphs = [];
  for (let i = 0; i < count; i++) {
    paragraphs.push(randomParagraph({ min: 2, max: 5 }));
  }
  return paragraphs;
}

export default function SentenceList(props) {
  const [size, setSize] = useState(null);
  const parentRef = useRef();
  useEffect(() => {
    if (parentRef.current) {
      setSize({
        height: parentRef.current.offsetHeight,
        width: parentRef.current.offsetWidth
      });
    }
  }, [parentRef]);

  const [paragraphs] = useState(createParagraphs(10000));

  return (
    <div
      ref={parentRef}
      style={{
        height: "90vh",
        width: "90%",
        marginTop: '20px',
        marginBottom: '40px',
      }}
    >
      <DynamicSizeList
        height={size ? size.height : 600}
        width={size ? size.width : 200}
        itemCount={paragraphs.length}
        itemSize={() => 10} // dummy. Will not be used
        overscanCount={5}
      >
        {(index, ref) => {
          return (
            <div ref={ref} style={textContainerStyle}>
              <div style={textFieldStyle}>
                {`${index}: ${paragraphs[index]}...`}
              </div>
            </div>
          );
        }}
      </DynamicSizeList>
    </div>
  );
}
