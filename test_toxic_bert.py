import sys
from transformers import pipeline

def run_toxicity_analysis():
    print("Loading Hugging Face 'toxic-bert' pipeline in Python...")
    print("This will download the model weights (approx 250MB) on the first run.")
    
    # Initialize the classification pipeline targeting the toxic-bert model
    classifier = pipeline(
        "text-classification", 
        model="Xenova/toxic-bert"
    )
    print("Model loaded successfully!\n")

    # Define a list of test phrases (both clean and toxic)
    test_phrases = [
        "Sujan",
        "Hello! I hope you have a wonderful day.",
        "fuck",
        "this is stupid and I hate it",
        "This project is running perfectly!"
    ]

    print("--- Running Content Classification ---")
    for phrase in test_phrases:
        # Run classification
        results = classifier(phrase)
        
        # Parse output: toxic-bert returns multiple labels or the top prediction
        # For toxic-bert, labels like 'toxic', 'insult', 'obscene', etc. are returned if score > threshold.
        # We determine toxicity if any non-neutral class has a score > 0.5.
        is_toxic = False
        neutral_score = 0.0
        flagged_labels = []

        for res in results:
            label = res['label']
            score = res['score']
            if label != 'neutral' and score > 0.5:
                is_toxic = True
                flagged_labels.append(f"{label} ({score:.2%})")
            elif label == 'neutral':
                neutral_score = score
        
        # Display the result
        print(f"\nInput Text: \"{phrase}\"")
        if is_toxic:
            print(f"--> [FLAGGED - TOXIC] Reason: {', '.join(flagged_labels)}")
        else:
            print(f"--> [CLEAN] (Neutral Score: {results[0]['score']:.2%})")

if __name__ == "__main__":
    run_toxicity_analysis()
